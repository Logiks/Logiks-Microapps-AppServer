//BullMQ Driver for Queueing - Redis backed, competing consumers across nodes.
//
//config (all under CONFIG.queue):
//  driver: "bullmq"
//  redis:  optional ioredis options ({host, port, db, password, ...}) or a "redis://" URL for a Redis
//          dedicated to the queue. When absent, the system Redis (CONFIG.cache) is used.
//  prefix: key prefix for every BullMQ key (default "lgksq"), so queue keys never mix with cache keys.
//  attempts / backoffMs: defaults for retries (a consumer's maxAttempts option wins).
//
//Redis should run with maxmemory-policy noeviction, or queued jobs can be evicted under memory pressure.

const crypto = require("crypto");
const IORedis = require("ioredis");
const { Queue, Worker } = require("bullmq");

const QueueDriver = require("./QueueDriver");
const QueueMessage = require("../QueueMessage");

const JOB_NAME = "msg";

class BullMQDriver extends QueueDriver {

    constructor(config = {}) {
        super();

        this.config = {
            prefix: config.prefix || "lgksq",
            attempts: config.attempts || 5,
            backoffMs: config.backoffMs || 1000,
            concurrency: config.prefetch || config.concurrency || 10,
            ...config
        };

        this.connection = null;
        this.queues = new Map();
        this.workers = new Map();
    }

    //Queue-specific Redis if one is configured, otherwise the system Redis (CONFIG.cache)
    redisSettings() {
        const own = this.config.redis;
        if (own) return { source: "queue", value: own };

        //queue.host may carry a redis:// URL, since that is where other drivers keep their server address
        if (typeof this.config.servers === "string" && /^rediss?:\/\//i.test(this.config.servers)) {
            return { source: "queue", value: this.config.servers };
        }

        return { source: "system", value: this.config.systemRedis || {} };
    }

    async connect() {
        const { source, value } = this.redisSettings();

        //BullMQ needs blocking commands to wait indefinitely and commands issued while reconnecting
        //to be held back, which differs from how the cache connection is set up.
        const forced = { maxRetriesPerRequest: null, enableOfflineQueue: true };

        if (typeof value === "string") {
            this.connection = new IORedis(value, forced);
        } else {
            //keyPrefix is an ioredis feature BullMQ refuses; the BullMQ prefix does that job
            const { keyPrefix, enable, ...rest } = value;
            this.connection = new IORedis({ ...rest, ...forced });
        }

        this.connection.on("error", err => {
            console.error("[Logiks Queue] BullMQ Redis error:", err.message);
        });

        await new Promise((resolve, reject) => {
            if (this.connection.status === "ready") return resolve();
            this.connection.once("ready", resolve);
            this.connection.once("error", reject);
        });

        console.log("\x1b[36m%s\x1b[0m", `[Logiks Queue] BullMQ using ${source} Redis, prefix '${this.config.prefix}'`);
        return this;
    }

    getQueue(queue) {
        if (!this.queues.has(queue)) {
            this.queues.set(queue, new Queue(queue, { connection: this.connection, prefix: this.config.prefix }));
        }
        return this.queues.get(queue);
    }

    async publish(queue, payload, options = {}) {
        const id = options.id || crypto.randomUUID();

        const message = {
            id,
            queue,
            payload,
            headers: options.headers || {},
            timestamp: Date.now()
        };

        await this.getQueue(queue).add(JOB_NAME, message, {
            jobId: id,
            attempts: options.maxAttempts || this.config.attempts,
            backoff: { type: "exponential", delay: this.config.backoffMs },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 }
        });

        return { id, published: true };
    }

    async consume(queue, handler, options = {}) {
        const maxAttempts = options.maxAttempts || this.config.attempts;

        const worker = new Worker(queue, async job => {
            const data = job.data || {};

            //A throw here is a failed attempt: BullMQ retries it with backoff until attempts run out
            await handler(new QueueMessage({
                id: data.id || job.id,
                queue,
                payload: data.payload,
                headers: data.headers || {},
                attempts: job.attemptsMade,
                timestamp: data.timestamp,
                raw: job
            }));
        }, {
            connection: this.connection,
            prefix: this.config.prefix,
            concurrency: options.prefetch || this.config.concurrency
        });

        worker.on("error", err => {
            console.error(`[Logiks Queue] BullMQ worker error (${queue}):`, err.message);
        });

        //BullMQ has no dead-letter queue of its own: copy a job that used up its attempts into the configured one
        worker.on("failed", async (job, err) => {
            if (!job || !options.deadLetter) return;
            if (job.attemptsMade < (job.opts?.attempts || maxAttempts)) return;

            try {
                const data = job.data || {};
                await this.publish(options.deadLetter, data.payload, {
                    id: `${data.id || job.id}-failed`,
                    headers: {
                        ...(data.headers || {}),
                        "x-error": err.message,
                        "x-original-queue": queue,
                        "x-attempts": job.attemptsMade
                    },
                    maxAttempts: 1
                });
            } catch (e) {
                console.error(`[Logiks Queue] Could not dead-letter job from ${queue}:`, e.message);
            }
        });

        this.workers.set(queue, worker);
        return worker;
    }

    //Acknowledgement and retries belong to the BullMQ worker: finishing the handler acks, throwing retries.
    async ack() {}

    async nack() {}

    async retry(message) {
        if (message?.raw && typeof message.raw.retry === "function") {
            await message.raw.retry();
        }
    }

    async purge(queue) {
        await this.getQueue(queue).obliterate({ force: true });
    }

    async getQueueStats(queue) {
        const counts = await this.getQueue(queue).getJobCounts("waiting", "active", "delayed", "failed", "completed");
        const q = this.getQueue(queue);

        return {
            queue,
            messages: (counts.waiting || 0) + (counts.delayed || 0),
            active: counts.active || 0,
            failed: counts.failed || 0,
            completed: counts.completed || 0,
            consumers: (await q.getWorkersCount().catch(() => 0))
        };
    }

    async disconnect() {
        for (const worker of this.workers.values()) {
            try { await worker.close(); } catch (err) { /* ignore */ }
        }
        for (const queue of this.queues.values()) {
            try { await queue.close(); } catch (err) { /* ignore */ }
        }
        this.workers.clear();
        this.queues.clear();

        if (this.connection) {
            try { await this.connection.quit(); } catch (err) { /* ignore */ }
        }
    }
}

module.exports = BullMQDriver;
