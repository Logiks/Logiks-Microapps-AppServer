//Demo Service

let users = [{name:"Bkm", id: 1}];

_.each(users, (user, i) => (user.id = i + 1));
let c = 0;

module.exports = function () {
	// return new Service(broker, 
	return {
		name: "demo",
		// version: 2,

		actions: {
			find: {
				cache: false,
				description: "List all users",
				handler(ctx) {
					let result = _.cloneDeep(users);
					if (ctx.params.limit) result = result.slice(0, ctx.params.limit);

					return result;
				}
			},

			get: {
				cache: {
					keys: ["id", "withPostCount"]
				},
				description:
					"Get a user by ID. This is a very long description, because we need to test the line wrapping feature of `table` component",
				handler(ctx) {
					const user = _.cloneDeep(this.findByID(ctx.params.id));
					if (user && ctx.params.withPostCount)
						return ctx
							.call("posts.count", { id: user.id }, { timeout: 1000 })
							.then(count => {
								user.postsCount = count;
								return user;
							});
					else return user;
				}
			},

			delayed() {
				c++;
				return this.Promise.resolve()
					.delay(c < 3 ? 6000 : 1000)
					.then(() => users);
			},

			slowGet(ctx) {
				return this.Promise.delay(2000).then(() => {
					this.logger.info("slowGet called");
					const user = _.cloneDeep(this.findByID(ctx.params.id));
					if (user && ctx.params.withPostCount)
						return ctx.call("posts.count", { id: user.id }).then(count => {
							user.postsCount = count;
							return user;
						});
					//.catch(err => this.logger.error(err));
					else return user;
				});
			}
		},

		methods: {
			findByID(id) {
				return _.cloneDeep(users.find(user => user.id == id));
			}
		}
	}
	// );
};
