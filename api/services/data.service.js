"use strict";

const cols = "groupid, title, value, class, sortorder";

module.exports = {
	name: "data",

	actions: {
		listGroups: {
			rest: {
				method: "GET",
				path: "/"
			},
			async handler(ctx) {
				var data = await db_selectQ("appdb", "do_lists", "groupid, count(*) as count", {
					"guid": [["global", ctx.meta.user.guid], "IN"],
					"blocked": "false"
				}, {}, "GROUP BY groupid ORDER BY sortorder");
				
				if(!data) data = [];

				return data;
			}
		},
		fetch: {
			rest: {
				method: "GET",
				fullPath: "/api/data/:groupid"
			},
			async handler(ctx) {
				var data = await db_selectQ("appdb", "do_lists", cols, {
					"guid": [["global", ctx.meta.user.guid], "IN"],
					"blocked": "false",
					"groupid": ctx.params.groupid
				}, {}, "ORDER BY sortorder");
				
				if(!data) data = [];

				return data;
			}
		},
		fetchFiltered: {
			rest: {
				method: "POST",
				fullPath: "/api/data/fetch"
			},
            params: {
                groupid: "string",
                filter: "object"
            },
			async handler(ctx) {
				if(!ctx.params.filter) ctx.params.filter = {};

				var data = await db_selectQ("appdb", "do_lists", cols, _.extend({},ctx.params.filter, {
					"guid": [["global", ctx.meta.user.guid], "IN"],
					"blocked": "false",
					"groupid": ctx.params.groupid
				}), {}, "ORDER BY sortorder");
				
				if(!data) data = [];

				return data;
			}
		},
		fetchBulk: {
			rest: {
				method: "POST",
				fullPath: "/api/data/bulk"
			},
            params: {
                groupids: "array"
            },
			async handler(ctx) {
				if(!ctx.params.filter) ctx.params.filter = {};

				var data = await db_selectQ("appdb", "do_lists", cols, _.extend({},ctx.params.filter, {
					"guid": [["global", ctx.meta.user.guid], "IN"],
					"blocked": "false",
					"groupid": [ctx.params.groupids, "IN"]
				}), {}, "ORDER BY groupid, sortorder");
				
				if(!data) data = [];

				const grouped = data.reduce((acc, item) => {
						const key = item.groupid;
						if (!acc[key]) acc[key] = [];
						acc[key].push(item);
						return acc;
					}, {});

				return grouped;
			}
		},
	}
};
