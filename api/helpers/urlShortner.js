//URL Shortener Functions

module.exports = {

	initialize : function() {
        
    },

    urlShorten: function(srcURL, category, callback) {
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
}