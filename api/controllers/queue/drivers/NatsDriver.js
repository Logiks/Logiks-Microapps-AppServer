//NATS Jetstream Queue Driver
//
//docker run --rm -p 4222:4222 nats:latest -js

const {
    connect,
    StringCodec,
    AckPolicy,
    DeliverPolicy,
    RetentionPolicy,
    StorageType
} = require("nats");

const QueueDriver = require("./QueueDriver");
const QueueMessage = require("../QueueMessage");

class NatsDriver extends QueueDriver {

    constructor(config = {}) {
        super();

        this.config = {
            servers: config.servers || "nats://127.0.0.1:4222",
            name: config.name || `logiks-queue`,//${process.pid}

            streamPrefix: config.streamPrefix || "LOGIKS",

            durable: config.durable !== false,

            maxDeliver: config.maxDeliver || 5,

            ackWait: config.ackWait || 30000,

            maxAckPending: config.maxAckPending || 100,

            ...config
        };

        this.nc = null;
        this.js = null;
        this.jsm = null;

        this.sc = StringCodec();

        this.consumers = new Map();
    }

    async connect() {

        this.nc = await connect({
            servers: this.config.servers,
            name: this.config.name
        });

        this.js = this.nc.jetstream();
        this.jsm = await this.nc.jetstreamManager();

        return this;
    }

    getStreamName(queue) {

        return `${this.config.streamPrefix}_${queue
            .replace(/[^a-zA-Z0-9]/g, "_")
            .toUpperCase()}`;
    }

    getSubject(queue) {

        return `logiks.queue.${queue}`;
    }

    async ensureStream(queue) {

        const stream = this.getStreamName(queue);
        const subject = this.getSubject(queue);

        try {

            await this.jsm.streams.info(stream);

        } catch (err) {

            await this.jsm.streams.add({
                name: stream,

                subjects: [
                    subject
                ],

                retention: RetentionPolicy.Workqueue,

                storage: StorageType.File,

                max_msgs: -1,

                max_bytes: -1,

                max_age: 0
            });
        }

        return stream;
    }

    async publish(queue, payload, options = {}) {

        await this.ensureStream(queue);

        const subject = this.getSubject(queue);

        const message = {
            id: options.id || crypto.randomUUID(),
            queue,
            payload,
            headers: options.headers || {},
            timestamp: Date.now(),
            attempts: 0
        };

        const data = this.sc.encode(
            JSON.stringify(message)
        );

        const ack = await this.js.publish(
            subject,
            data,
            {
                msgID: message.id
            }
        );

        return {
            id: message.id,
            sequence: ack.seq,
            stream: ack.stream
        };
    }

    async consume(queue, handler, options = {}) {

        await this.ensureStream(queue);

        const stream = this.getStreamName(queue);

        // const durable = options.durable ||
        //     `${queue}-${this.config.name}`
        //         .replace(/[^a-zA-Z0-9_-]/g, "_");

        const durable = (
                options.durable ||
                `LOGIKS_${queue}`
            )
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .toUpperCase();

        let consumer;

        try {

            consumer = await this.jsm.consumers.info(
                stream,
                durable
            );

        } catch (err) {

            consumer = await this.jsm.consumers.add(
                stream,
                {
                    durable_name: durable,

                    ack_policy: AckPolicy.Explicit,

                    ack_wait:
                        options.ackWait ||
                        this.config.ackWait * 1000000,

                    max_deliver:
                        options.maxDeliver ||
                        this.config.maxDeliver,

                    max_ack_pending:
                        options.maxAckPending ||
                        this.config.maxAckPending,

                    deliver_policy:
                        DeliverPolicy.All
                }
            );
        }

        const consumerInstance =
            await this.js.consumers.get(
                stream,
                durable
            );

        const messages =
            await consumerInstance.consume();

        this.consumers.set(queue, messages);

        (async () => {

            for await (const msg of messages) {

                let parsed;

                try {

                    parsed = JSON.parse(
                        this.sc.decode(msg.data)
                    );

                } catch (err) {

                    await msg.term();
                    continue;
                }

                const queueMessage =
                    new QueueMessage({
                        id: parsed.id,
                        queue,
                        payload: parsed.payload,
                        headers: parsed.headers,
                        attempts: parsed.attempts || 0,
                        timestamp: parsed.timestamp,
                        raw: msg
                    });

                try {

                    await handler(
                        queueMessage
                    );

                    await msg.ack();

                } catch (err) {

                    await this.handleError(
                        msg,
                        parsed,
                        err,
                        options
                    );
                }
            }

        })();

        return {
            queue,
            durable
        };
    }

    async handleError(msg, message, error, options) {

        const maxAttempts =
            options.maxAttempts ||
            this.config.maxDeliver;

        message.attempts =
            (message.attempts || 0) + 1;

        if (message.attempts >= maxAttempts) {

            if (options.deadLetter) {

                await this.publish(
                    options.deadLetter,
                    message.payload,
                    {
                        id: message.id,
                        headers: {
                            ...message.headers,

                            "x-error":
                                error.message,

                            "x-original-queue":
                                message.queue,

                            "x-attempts":
                                message.attempts
                        }
                    }
                );
            }

            await msg.term();

        } else {

            // Leave unacknowledged.
            // JetStream will redeliver it.
            await msg.nak(
                options.retryDelay || 0
            );
        }
    }

    async ack(message) {

        if (message.raw) {
            await message.raw.ack();
        }
    }

    async nack(message, options = {}) {

        if (message.raw) {

            await message.raw.nak(
                options.delay || 0
            );
        }
    }

    async retry(message, options = {}) {

        await this.nack(
            message,
            options
        );
    }

    async disconnect() {

        for (const consumer of this.consumers.values()) {

            try {
                await consumer.close();
            } catch (err) {
                // ignore
            }
        }

        this.consumers.clear();

        if (this.nc) {

            try {
                await this.nc.drain();
            } catch (err) {
                await this.nc.close();
            }
        }
    }

    async purge(queue) {

        const stream =
            this.getStreamName(queue);

        await this.jsm.streams.purge(
            stream
        );
    }

    async getQueueStats(queue) {

        const stream =
            this.getStreamName(queue);

        const info =
            await this.jsm.streams.info(stream);

        return {
            queue,
            stream,

            messages:
                info.state.messages,

            bytes:
                info.state.bytes,

            firstSeq:
                info.state.first_seq,

            lastSeq:
                info.state.last_seq
        };
    }
}

module.exports = NatsDriver;