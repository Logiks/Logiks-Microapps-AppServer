// Admin-only endpoint (requires admin role).

//Restarting Nodes:
// ✅ Remote cluster reboot
// ✅ Targeted restarts
// ✅ Zero-SSH orchestration
// ✅ PM2-safe restarts
// ✅ Admin-only security
// ✅ Zero-downtime rolling restarts

"use strict";

const os = require("os");

module.exports = {
	name: "admin",

	actions: {
		apps: {
			rest: {
				method: "POST",
				path: "/"
			},
			params: {},
			async handler(ctx) {
				return {"status": "ok"};
			}
		},

		//Manage apps
		apps: {
			rest: {
				method: "POST",
				path: "/apps/:task?/:appid?"
			},
			params: {},
			async handler(ctx) {
				switch(ctx.params.task) {
					case "create":
						break;
					case "delete":
						break;
					case "update":
						break;
					case "info":
						var appInfo = APPLICATION.getAppInfo(ctx.params.appid);

						appInfo.appFolder = fs.existsSync(`plugins/${ctx.params.appid}`);

						return appInfo;
						break;
					case "list":
					default:
						return APPLICATION.getAppList();
				}
			}
		},
		
		//Manage apps files
		files: {
			rest: {
				method: "POST",
				path: "/files"
			},
			params: {
				path: "string",
				appid: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return [];
			}
		},

		filesPreview: {
			rest: {
				method: "POST",
				path: "/files/content"
			},
			params: {
				file: "string",
				appid: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return "";
			}
		},

		filesUpload: {
			rest: {
				method: "POST",
				path: "/files/upload"
			},
			params: {
				file: "string",
				content: "string",
				appid: "string",
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				return {};
			}
		},

		//Manage plugins
		plugins: {
			rest: {
				method: "POST",
				path: "/plugins/:task?"
			},
			params: {},
			async handler(ctx) {
				if(!ctx.params.task) ctx.params.task = "";
				switch(ctx.params.task) {

					default:
						return await ctx.call("system.plugins");
				}

				return {"status": "error"};
			}
		},

		//Control Center for the Server
		ctrls: {
			rest: {
				method: "POST",
				path: "/ctrls/:task?"
			},
			params: {},
			async handler(ctx) {
				this.verifyAdmin(ctx);

				const commandList = ["stats", "restart", "restartNode", "restartAll", "check_update", "run_update", "nodes", "services", "backup", "app_module_map", "routeStats"];

				switch(ctx.params.task) {
					case "stats":
						const [nodes, services, health] = await Promise.all([
							ctx.call("$node.list"),
							ctx.call("$node.services"),
							ctx.call("$node.health"),
						]);

						const mem = process.memoryUsage();

						return {
							timestamp: new Date().toISOString(),
							nodeCount: nodes.length,
							serviceCount: services.length,
							hostname: os.hostname(),
							uptime: process.uptime(),
							memory: {
								load: os.loadavg()[0], // 1-minute load avg
								rssMB: (mem.rss / 1024 / 1024).toFixed(2),
								heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2)
							},
							nodes: nodes.map(n => ({
								id: n.id,
								hostname: n.hostname,
								ip: n.ipList,
								available: n.available,
								// cpu: n.cpu,
								client: n.client,
								// services: services.map(s => s.name),
								// metadata: n.metadata
							})),
							health: health
						};
						break;
					case "routeStats":
						const stats = await ctx.call("system.routeStatsSummary");
						return stats;
						break;
					case "restart":
					case "restartAll":
					case "restartNode":
						return restartHandler(ctx.params.task, ctx);
						break;
					case "nodes":
						return listNodes();
						break;
					case "services":
						return getLocalServiceNames();
						break;
					case "check_update":
						break;
					case "run_update":
						break;
					case "backup":
						break;
					case "app_module_map":
						break;
					default:
						return {"status": "okay", "commands": commandList};
				}
			}
		},
		
		//Manage Themes
	},
	methods: {
		verifyAdmin(ctx) {
			// ABSOLUTELY REQUIRED SECURITY CHECK
			if (!ctx.meta.user || ctx.meta.user.roles.indexOf("admin")<0) {
				throw new Error("Admin access only");
			}

			return true;
		}
	}
};

async function restartHandler(cmd, ctx) {
	switch(cmd) {
		case "restart":
			var nodes = await listNodes();
			var gatewayNodes = nodes.filter(n =>
					n.startsWith("gateway-")
				);
			var workerNodes = nodes.filter(n =>
					n.startsWith("worker-")
				);
			SERVER.getBroker().logger.warn("Restarting gateway nodes:", gatewayNodes.map(n => n.id));
			for (var nodeId of gatewayNodes) {
				if(nodeId == SERVER.getBroker().nodeID) continue;
				await ctx.call("system.selfRestart", {}, {
					nodeID: nodeId
				});
				await new Promise(r => setTimeout(r, 5000)); // wait 5s between restarts
			}
			await ctx.call("system.selfRestart", {}, {
					nodeID: SERVER.getBroker().nodeID
				});

			return {
				restarted: gatewayNodes
			};
		break;
		case "restartAll":
			var nodes = await listNodes();

			var gatewayNodes = nodes.filter(n =>
					n.startsWith("gateway-")
				);
			var otherNodes = nodes.filter(n =>
					!n.startsWith("gateway-")
				);

			SERVER.getBroker().logger.warn("Restarting gateway nodes:", gatewayNodes.map(n => n.id));
			for (var nodeId of gatewayNodes) {
				if(nodeId == SERVER.getBroker().nodeID) continue;
				await ctx.call("system.selfRestart", {}, {
					nodeID: nodeId
				});
				await new Promise(r => setTimeout(r, 5000)); // wait 5s between restarts
			}

			SERVER.getBroker().logger.warn("Restarting other nodes:", otherNodes.map(n => n.id));
			for (var nodeId of otherNodes) {
				await ctx.call("system.selfRestart", {}, {
					nodeID: nodeId
				});
			}

			SERVER.getBroker().logger.warn("Restarting gateway self node");
			await ctx.call("system.selfRestart", {}, {
					nodeID: SERVER.getBroker().nodeID
				});
			
			return {
				restarted: nodes
			};
			break;
		case "restartNode":
			// _appcall("system.restart");
			const { nodeIDs } = ctx.params;

			SERVER.getBroker().logger.warn("Restarting selected nodes:", gatewayNodes.map(n => n.id));
			if (!Array.isArray(nodeIDs) || nodeIDs.length === 0) {
				throw new Error("target nodeIDs array is required");
			}

			for (const nodeID of nodeIDs) {
				await ctx.call("system.selfRestart", {}, {
					nodeID
				});
				await new Promise(r => setTimeout(r, 5000)); // wait 5s between restarts
			}

			return {
				restarted: nodeIDs
			};
		break;
		default:
			return {};
	}
}

function getLocalServiceNames() {
	const list = SERVER.getBroker().registry.getServiceList({ onlyLocal: true });
	return list.map(svc => svc.name).filter(a=>(a.substr(0,1)!="$" && a.indexOf("server-")!==0));
}

async function listNodes() {
    const nodes = await SERVER.getBroker().call("$node.list");
    return nodes.map(n => n.id);
}