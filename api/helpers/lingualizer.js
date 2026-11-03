//For spporting lingualization of the app, we can use this helper function to get the translated text based on the user's language preference. This function will take a key and return the corresponding translation from a predefined dictionary.
//Path for data - /misc/apps/<appid>/i18n/<lang>.ling

const sha1 = require('sha1');

const LANGUAGES = {};
const LANGUAGE_HASH = {};

module.exports = {

    initialize : async function() {
        console.log("\x1b[36m%s\x1b[0m","Lingualizer Intialiased");
    },

    loadedLanguages: function() {
        return Object.keys(LANGUAGES);
    },
    
    loadLanguage: async function(appId, lang) {
        var filePath = path.join(ROOT_PATH, `misc/apps/${appId}/i18n/${lang}.ling`);
        if(!fs.existsSync(filePath)) return {};

        var data = fs.readFileSync(filePath, 'utf8');
        var lines = data.split('\n');
        var translations = {};
        for(var i=0; i<lines.length; i++) {
            var line = lines[i].trim();
            if(line && line.indexOf('=>')>0) {
                var parts = line.split('=>');
                translations[parts[0].trim()] = parts[1].trim();
            }
        }
        LANGUAGES[`${appId}:${lang}`] = translations;
        LANGUAGE_HASH[`${appId}:${lang}`] = sha1(JSON.stringify(translations));

        return true;
    },

    fetchLanguageHash: async function(appId, lang) {
        if(LANGUAGE_HASH[`${appId}:${lang}`]) return LANGUAGE_HASH[`${appId}:${lang}`];

        await this.loadLanguage(appId, lang);
        
        return LANGUAGE_HASH[`${appId}:${lang}`];
    },

    fetchLanguageData: async function(appId, lang) {
        if(LANGUAGES[`${appId}:${lang}`]) return LANGUAGES[`${appId}:${lang}`];

        await this.loadLanguage(appId, lang);
        
        return LANGUAGES[`${appId}:${lang}`];
    },

    translate : async function(text, appId, lang) {
        var translations = await this.fetchLanguageData(appId, lang);
        if(!translations) return text;
        return translations[text] || translations[text.toLowerCase()] || text;
    }
}