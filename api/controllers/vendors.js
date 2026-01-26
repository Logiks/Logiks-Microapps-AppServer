//Third Party Vendor Management
//This is one place where we control all vendors and how they operate

var VENDORS = [];
var LISTNERS = [];

module.exports = {

    initialize : async function() {
        this.loadVendors();

        console.log("\x1b[36m%s\x1b[0m","Vendor Management System Initialized");
    },

    addListener: function(func, vendorType) {
        
    },

    //Load Messaging Vendors from DB
    loadVendors: async function() {
        var vendorInfo = await _DB.db_selectQ("appdb", "sys_vendors", "*", {
                blocked: "false"
            },{});
        if(!vendorInfo || !vendorInfo.results || vendorInfo.results.length<=0) return false;

        VENDORS = vendorInfo.results;

        const uniqueVendors = [...new Set(VENDORS.map(obj => obj.vendor_type))];
        uniqueVendors.forEach(vendorType => {
            runAppEventListeners(vendorType, {});
        })
        
    },

    getAvailableVendors: function(vendorType) {
        return VENDORS.filter(a=>a.vendor_type.includes(vendorType));
    },
}
