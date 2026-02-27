//All Node Related Admin Functionalities to control worker nodes

"use strict";

module.exports = {
	name: "admin.nodes",

	actions: {
        listNodes: {
			rest: {
				method: "GET",
				path: "/"
			},
			params: {},
            handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })

                return listNodes();
            }
        },
        nodeInfo: {
            rest: {
                method: "GET",
                path: "/info/:nodeId"
            },
            params: {
                nodeId: "string"
            },
            handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })
                
                return nodeInfo(ctx.params.nodeId);
            }
        },
        services: {
            rest: {
                method: "GET",
                path: "/services"
            },
            handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })
                
                return getLocalServiceNames();
            }
        },

        cmd: {
            rest: {
                method: "GET",
                path: "/cmd"
            },
            params: {
                cmd: "string",
                nodeId: { type: "string", optional: true, default: "" },
            },
            handler(ctx) {
                ctx.call("admin.verifyAdmin", {}, { meta: ctx.meta })
                
                switch(ctx.params.cmd) {
                    case "restart":
					case "restartAll":
					case "restartNode":
						return restartHandler(ctx.params.cmd, ctx);
						break;
                }
            }
        }
    },

    methods: { 
    }
}

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
			for (var nodeID of gatewayNodes) {
				if(nodeID == SERVER.getBroker().nodeID) continue;
				await ctx.call("system.selfRestart", {}, {
					nodeID: nodeID
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
			for (var nodeID of gatewayNodes) {
				if(nodeID == SERVER.getBroker().nodeID) continue;
				await ctx.call("system.selfRestart", {}, {
					nodeID: nodeId
				});
				await new Promise(r => setTimeout(r, 5000)); // wait 5s between restarts
			}

			SERVER.getBroker().logger.warn("Restarting other nodes:", otherNodes.map(n => n.id));
			for (var nodeId1 of otherNodes) {
				await ctx.call("system.selfRestart", {}, {
					nodeID: nodeId1
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
			// _call("system.restart");
			const { nodeId } = ctx.params;

			SERVER.getBroker().logger.warn("Restarting selected nodes:", gatewayNodes.map(n => n.id));
			if (!Array.isArray(nodeId) || nodeId.length === 0) {
				throw new Error("target nodeId array is required");
			}

			for (const nodeID of nodeId) {
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
    return nodes.filter(n => n.available === true).map(n => n.id);
}

async function nodeInfo(nodeId) {
	if(!nodeId) return {"status": "error", "message": "NodeID not defined"};
	
	const nodes = await SERVER.getBroker().call("$node.list");
	const nodeInfo = nodes.filter(a=>a.id==nodeId);

	if(nodeInfo.length<=0) return {"status": "error", "message": "Node Not Found"};
	return nodeInfo[0];
}