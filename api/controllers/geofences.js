/*
 * Geofence Tasks Related Controller
 * Distance Calculations in meters
 * */

// All inputs below arrive from request data (geolocation comes straight from the login payload), so they are
// validated before being placed in SQL text.
function parseLatLng(geolocation) {
    const geoArr = String(geolocation || "").split(",");
    const lat = Number(geoArr[0]);
    const lng = Number(geoArr[1]);
    if(geoArr.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error("Invalid geolocation");
    }
    return {lat, lng};
}

function safeTable(geoTable) {
    if(!/^[A-Za-z0-9_]+$/.test(geoTable)) throw new Error("Invalid geofence table");
    return geoTable;
}

function esc(v) {
    return String(v).replace(/\\/g, "\\\\").replace(/'/g, "''");
}

function safeInt(v, fallback) {
    const n = parseInt(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = {

    initialize: function() {
        return true; //Public Controller
    },

    findGeofence: async function(guid, geolocation, groupid='general', fenceType = "polygon", limit = 10, max_distance = 1, geoTable = "lgks_geofences") {
        const {lat, lng} = parseLatLng(geolocation);
        const radius_in_meters = Number(max_distance) * 1000;//meters
        if(!Number.isFinite(radius_in_meters)) throw new Error("Invalid max_distance");
        geoTable = safeTable(geoTable);
        limit = safeInt(limit, 10);
        
        switch(fenceType) {
            case "polygon":
                var SQL_QUERY = `SELECT *, ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) as distance FROM ${geoTable} WHERE ST_Contains(geofence_area, ST_SRID(POINT(${lng}, ${lat}), 4326)) AND blocked='false' AND (guid='global' OR guid='${esc(guid)}') AND geofence_groupid='${esc(groupid)}' LIMIT ${limit}`;
                var dbData = await _DB.db_query("appdb", SQL_QUERY, {});
                return dbData?.results;
                break;
            case "circular":
                var SQL_QUERY = `SELECT *, ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) as distance FROM ${geoTable} WHERE ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) <= ${radius_in_meters} AND blocked='false' AND (guid='global' OR guid='${esc(guid)}') AND geofence_groupid='${esc(groupid)}' LIMIT ${limit}`;
                var dbData = await _DB.db_query("appdb", SQL_QUERY, {});
                return dbData?.results;
                break;
            default:
                return false;
        }
    },
    
    listGeofences: async function(guid, geolocation, groupid='general', limit = 10, geoTable = "lgks_geofences") {
        const {lat, lng} = parseLatLng(geolocation);
        geoTable = safeTable(geoTable);
        limit = safeInt(limit, 10);

        var SQL_QUERY = `SELECT *, ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) as distance FROM ${geoTable} WHERE blocked='false' AND (guid='global' OR guid='${esc(guid)}') AND geofence_groupid='${esc(groupid)}' ORDER BY ST_Distance_Sphere(ST_SRID(POINT(${lng}, ${lat}), 4326), geofence_center) ASC LIMIT ${limit}`;
        var dbData = await _DB.db_query("appdb", SQL_QUERY, {});
        return dbData?.results;
    },

    // insertGeofencePolygon: async function(guid, groupid='general', name, geoShapeType='polygon', geoData, remarks='', ctx) {
        //UPDATE geofences SET geofence_center = ST_PointOnSurface(geofence_area);
    // }
}
