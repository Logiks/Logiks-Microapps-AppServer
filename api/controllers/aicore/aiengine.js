//Default AI Engine Interface

module.exports = class AIEngine {
    
    constructor(params = {}) {
        this.params = params;
    }
    
    async sendMessage(sessId, message, userInfo, params = {}) {
        console.log("AIEngine", this.params);
        return false;
    }
}