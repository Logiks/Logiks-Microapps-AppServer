//Queue Management

const NatsDriver =
    require("./drivers/NatsDriver");

const RabbitMQDriver =
    require("./drivers/RabbitMQDriver");

class QueueManager {

    constructor(config = {}) {

        this.config = config;
        this.connected = false;

        this.driver =
            this.createDriver(config);
    }

    createDriver(config) {

        const driver =
            config.driver || "nats";

        switch (
            driver.toLowerCase()
        ) {

            case "nats":

                return new NatsDriver(
                    config
                );

            case "rabbitmq":

            case "rabbit":

                return new RabbitMQDriver(
                    config
                );

            default:

                throw new Error(
                    `Unknown queue driver: ${driver}`
                );
        }
    }

    async connect() {

        await this.driver.connect();
        this.connected = true;
        return this;
    }

    async ensureConnected() {

        if (!this.connected) {
            await this.connect();
        }
    }

    async publish(
        queue,
        payload,
        options = {}
    ) {

        return this.driver.publish(
            queue,
            payload,
            options
        );
    }

    async consume(
        queue,
        handler,
        options = {}
    ) {

        return this.driver.consume(
            queue,
            handler,
            options
        );
    }

    async ack(message) {

        return this.driver.ack(
            message
        );
    }

    async nack(
        message,
        options = {}
    ) {

        return this.driver.nack(
            message,
            options
        );
    }

    async retry(
        message,
        options = {}
    ) {

        return this.driver.retry(
            message,
            options
        );
    }

    async purge(queue) {

        return this.driver.purge(
            queue
        );
    }

    async stats(queue) {

        return this.driver.getQueueStats(
            queue
        );
    }

    async disconnect() {

        return this.driver.disconnect();
    }
}

module.exports = QueueManager;