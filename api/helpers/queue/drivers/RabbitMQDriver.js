//RabbotMQ Driver for Queueing


const amqp = require("amqplib");
const crypto = require("crypto");

const QueueDriver = require("./QueueDriver");
const QueueMessage = require("../QueueMessage");

class RabbitMQDriver extends QueueDriver {

    constructor(config = {}) {

        super();

        this.config = {
            url:
                config.servers || "amqp://127.0.0.1:5672",

            prefetch:
                config.prefetch || 10,

            durable:
                config.durable !== false,

            queueType:
                config.queueType || "quorum",

            ...config
        };

        this.connection = null;
        this.channel = null;

        this.consumers = new Map();
    }

    async connect() {

        this.connection =
            await amqp.connect(
                this.config.url
            );

        this.channel =
            await this.connection.createChannel();

        this.connection.on(
            "error",
            err => {

                console.error(
                    "[Logiks Queue] RabbitMQ error:",
                    err
                );
            }
        );

        this.connection.on(
            "close",
            () => {

                console.warn(
                    "[Logiks Queue] RabbitMQ connection closed"
                );
            }
        );

        return this;
    }

    async ensureQueue(queue) {

        return this.channel.assertQueue(
            queue,
            {
                durable:
                    this.config.durable,

                arguments: {
                    "x-queue-type":
                        this.config.queueType
                }
            }
        );
    }

    async publish(queue, payload, options = {}) {

        await this.ensureQueue(queue);

        const id =
            options.id ||
            crypto.randomUUID();

        const message = {

            id,

            queue,

            payload,

            headers:
                options.headers || {},

            timestamp:
                Date.now(),

            attempts:
                options.attempts || 0
        };

        const buffer =
            Buffer.from(
                JSON.stringify(message)
            );

        const published =
            this.channel.sendToQueue(
                queue,
                buffer,
                {
                    persistent: true,

                    messageId: id,

                    contentType:
                        "application/json",

                    headers:
                        message.headers
                }
            );

        if (!published) {

            // amqplib will apply backpressure.
            // Wait for drain.
            await new Promise(resolve => {

                this.channel.once(
                    "drain",
                    resolve
                );

            });
        }

        return {
            id,
            published
        };
    }

    async consume(queue, handler, options = {}) {

        await this.ensureQueue(queue);

        const prefetch =
            options.prefetch ||
            this.config.prefetch;

        await this.channel.prefetch(
            prefetch
        );

        const result =
            await this.channel.consume(
                queue,

                async msg => {

                    if (!msg) {
                        return;
                    }

                    let parsed;

                    try {

                        parsed =
                            JSON.parse(
                                msg.content.toString()
                            );

                    } catch (err) {

                        this.channel.reject(
                            msg,
                            false
                        );

                        return;
                    }

                    const queueMessage =
                        new QueueMessage({

                            id:
                                parsed.id,

                            queue,

                            payload:
                                parsed.payload,

                            headers:
                                parsed.headers || {},

                            attempts:
                                parsed.attempts || 0,

                            timestamp:
                                parsed.timestamp,

                            raw: msg
                        });

                    try {

                        await handler(
                            queueMessage
                        );

                        this.channel.ack(
                            msg
                        );

                    } catch (err) {

                        await this.handleError(
                            msg,
                            parsed,
                            err,
                            options
                        );
                    }
                },

                {
                    noAck: false
                }
            );

        this.consumers.set(
            queue,
            result.consumerTag
        );

        return result;
    }

    async handleError(
        msg,
        message,
        error,
        options
    ) {

        const attempts =
            (message.attempts || 0) + 1;

        const maxAttempts =
            options.maxAttempts || 5;

        if (
            attempts >= maxAttempts
        ) {

            if (options.deadLetter) {

                await this.publish(
                    options.deadLetter,

                    message.payload,

                    {
                        id:
                            message.id,

                        headers: {
                            ...message.headers,

                            "x-error":
                                error.message,

                            "x-original-queue":
                                message.queue,

                            "x-attempts":
                                attempts
                        },

                        attempts
                    }
                );
            }

            this.channel.reject(
                msg,
                false
            );

        } else {

            // Requeue for retry.
            this.channel.nack(
                msg,
                false,
                true
            );
        }
    }

    async ack(message) {

        if (message.raw) {

            this.channel.ack(
                message.raw
            );
        }
    }

    async nack(message, options = {}) {

        if (message.raw) {

            this.channel.nack(
                message.raw,

                false,

                options.requeue !== false
            );
        }
    }

    async retry(message) {

        await this.nack(
            message,
            {
                requeue: true
            }
        );
    }

    async purge(queue) {

        await this.channel.purgeQueue(
            queue
        );
    }

    async getQueueStats(queue) {

        const result =
            await this.channel.checkQueue(
                queue
            );

        return {

            queue,

            messages:
                result.messageCount,

            consumers:
                result.consumerCount
        };
    }

    async disconnect() {

        if (this.channel) {

            try {

                await this.channel.close();

            } catch (err) {
                // ignore
            }
        }

        if (this.connection) {

            try {

                await this.connection.close();

            } catch (err) {
                // ignore
            }
        }
    }
}

module.exports = RabbitMQDriver;