//URL Shortener Functions

const VENDOR = "cuttly";

module.exports = {

	initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","URL Shortner Initialized");
    },

    urlShorten: function(srcURL, category, callback) {
		switch(VENDOR) {
			case "cuttly": 
				cuttly(srcURL, category, callback);
			break;
			default:
				callback(false, "Vendor not supported - "+VENDOR);
		}
    	
    }
}

function cuttly(srcURL, category, callback) {
	var cuttlyAPI = `https://cutt.ly/api/api.php?key=${CONFIG.vendors.CUTTLY_KEY}&short=`+encodeURI(srcURL);

	axios({
			method: 'get',
			url: cuttlyAPI
		}).then(function (response) {
			if(response.data.url==null || response.data.url.status!=7) {
				return callback(false, "Error generating ShortURL (1)");
			}
			callback(response.data.url.shortLink);
			}).catch(function (error) {
			return callback(false, "Error generating ShortURL (2)");
			});
}