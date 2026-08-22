//Plugin/Module Related Helper Functions

module.exports = {

  initialize: function() {
  },

  checkPlugin: async function(pluginId) {
    const pluginsList = await SERVER.getBroker().call("system.plugins");
    return (pluginsList.PLUGINS || []).indexOf(pluginId)>=0;
  },

  checkService: async function(serviceId) {
    const pluginsList = await SERVER.getBroker().call("system.plugins");
    return (pluginsList.SERVICES || []).indexOf(serviceId)>=0;
  },

  fetchPluginInfo: async function(pluginid) {
    return {
        "pluginid": pluginid
    }
  }
}