class QueueDriver {

    async connect() {
        throw new Error("connect() not implemented");
    }

    async disconnect() {
        throw new Error("disconnect() not implemented");
    }

    async publish(queue, payload, options = {}) {
        throw new Error("publish() not implemented");
    }

    async consume(queue, handler, options = {}) {
        throw new Error("consume() not implemented");
    }

    async ack(message) {
        throw new Error("ack() not implemented");
    }

    async nack(message, options = {}) {
        throw new Error("nack() not implemented");
    }

    async retry(message, options = {}) {
        throw new Error("retry() not implemented");
    }

    async purge(queue) {
        throw new Error("purge() not implemented");
    }

    async getQueueStats(queue) {
        throw new Error("getQueueStats() not implemented");
    }
}

module.exports = QueueDriver;