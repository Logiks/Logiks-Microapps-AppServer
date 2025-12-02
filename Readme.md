# Logiks AppServer for Microapps

**Logiks Microapps AppServer** is a next-generation **Node.js framework** built for **microservice-first architectures**. Unlike traditional frameworks that depend on external orchestrators, it introduces **self-orchestration capabilities**, enabling services to **discover, scale, and heal themselves dynamically**.

It features an integrated **service catalog** that automates registration, discovery, and versioning of microapps — eliminating manual configuration. On top of this, the framework provides **automation layers** to streamline deployment, monitoring, and lifecycle management, reducing DevOps overhead while ensuring resilience and agility.

At its core, Logiks Microapps AppServer leverages the **MoleculerJS framework** for service discovery and versioning, and extends it to tackle the **complex challenges of modern IT landscapes**, making it an ideal platform for building **modular, distributed, and intelligent enterprise applications**.

---

## Key Differentiators

* **Microservice-First by Design**
  Every app is a microapp — modular, isolated, and independently scalable.

* **Self-Orchestration Engine**
  No need for external orchestrators — services auto-manage lifecycle, scaling, and dependencies.

* **Built-in Service Catalog**
  Automatic service registration, discovery, and versioning for seamless integration.

* **Automation Layers**
  Deployment, monitoring, and updates are intelligently handled, minimizing DevOps burden.

* **Enterprise-Ready**
  Security, resilience, and extensibility baked in for mission-critical distributed systems.

---

## Getting Started

### Installation

```bash
git clone https://github.com/logiks/logiks-microapps-appserver.git
cd logiks-microapps-appserver
npm install
```

### Starting the Microapp Server

Copy env_sample to .env, and configure the .env file as per requirement.

```bash
npm start
```

(Coming soon: detailed examples for creating, registering, and scaling microapps.)

---

## Guidelines for Working

* Keep services modular and independent.
* Use the **service catalog** for automatic discovery and versioning.
* Leverage **orchestration layers** to simplify deployment and monitoring.
* Leverage **automation layers** to automate process and repeat tasks with the apps.
* Extend using **Logiks-Microapps-Boilerplate** when building advanced microservices.

---

## References

* [MoleculerJS Documentation](https://moleculer.services/docs/)

---

## Tagline

**Microservices. Self-Orchestration. Automation.**
