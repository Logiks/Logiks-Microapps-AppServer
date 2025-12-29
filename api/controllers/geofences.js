/*
 * Geofence Tasks Related Controller
 * Distance Calculations in meters
 * */

module.exports = {

    initialize: function() {
        return true; //Public Controller
    },

    findGeofence: async function(guid, geolocation, groupid='general', fenceType = "polygon", limit = 10) {
        var geoArr = geolocation.split(",");
        const lat = geoArr[0];
        const lng = geoArr[1];
        const radius_in_meters = 10000*1000;//meters
        
        switch(fenceType) {
            case "polygon":
                var SQL_QUERY = `SELECT *, ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) as distance FROM lgks_geofences WHERE ST_Contains(geofence_area, ST_SRID(POINT(${lng}, ${lat}), 4326)) AND blocked='false' AND (guid='global' OR guid='${guid}') AND geofence_groupid='${groupid}' LIMIT ${limit}`;
                var dbData = await _DB.db_query("appdb", SQL_QUERY, {});
                return dbData?.results;
                break;
            case "circular":
                var SQL_QUERY = `SELECT *, ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) as distance FROM lgks_geofences WHERE ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) <= ${radius_in_meters} AND blocked='false' AND (guid='global' OR guid='${guid}') AND geofence_groupid='${groupid}' LIMIT ${limit}`;
                var dbData = await _DB.db_query("appdb", SQL_QUERY, {});
                return dbData?.results;
                break;
            default:
                return false;
        }
    },
    
    listGeofences: async function(guid, geolocation, groupid='general', limit = 10) {
        var geoArr = geolocation.split(",");
        const lat = geoArr[0];
        const lng = geoArr[1];

        var SQL_QUERY = `SELECT *, ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) as distance FROM lgks_geofences WHERE blocked='false' AND (guid='global' OR guid='${guid}') AND geofence_groupid='${groupid}' ORDER BY ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) ASC LIMIT ${limit}`;
        var dbData = await _DB.db_query("appdb", SQL_QUERY, {});
        return dbData?.results;
    },

    // insertGeofencePolygon: async function(guid, groupid='general', name, geoShapeType='polygon', geoData, remarks='', ctx) {
        //UPDATE geofences SET geofence_center = ST_PointOnSurface(geofence_area);
    // }
}
