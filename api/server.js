//For Starting the Server and Load required Services

const { ServiceBroker } = require("moleculer");
const ApiService = require("moleculer-web");

module.exports = {
	start: async function() {
	    // Create a ServiceBroker
	    const broker = new ServiceBroker({
	        logger: console,
	        logLevel: "error",
	        cacher: true,
	        nodeID: process.env.SERVER_ID,
	        transporter: process.env.TRANSPORTER
	    });


	    broker.createService({
	        name: `${_CONFIG.SERVER_ID}_MAIN`,//"APIGateway-Main",
	        actions: {
	            
	        },

	        mixins: [ApiService],

	        settings: {
	            routes: [{
	                path: "/",

	                whitelist: [
	                    "**"

	                    //     // Access any actions in 'posts' service
	                    //     "posts.*",
	                    //     // Access call only the `users.list` action
	                    //     "users.list",
	                    //     // "customer.*",
	                    //     // Access any actions in 'math' service
	                    //     /^math\.\w+$/
	                ],

	                alias: [

	                ]
	            }]
	        }
	    });

	    fs.readdirSync('./api/services/').forEach(function(file) {
	        if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
	            var filePath = path.resolve('./api/services/' + file);
	            var clsName = file.replace('.js','').toUpperCase();

	            broker.loadService(filePath);
	            _ENV.SERVICES.push(clsName);

	            // console.log("Loading Service", filePath);
	        }
	    });

	    // Start the broker
	    broker.start()
	        // Call the service
	        .then(() => {
	            broker.call("demo.find", { a: 5, b: 3 }).then(a=>console.log("DEMO", a))
	            return 0;
	        })
	        // Print the response
	        // .then(res => console.log("5 + 3 =", res))
	        .catch(err => console.error(`Error occured! ${err.message}`));
	}
}