// plugins/group.js
const settings = require('../settings'); 
const { saveSettings } = require('../helpers/settingsSaver'); // Updated path
const { saveState } = require('../stateManager'); // State persistence manager
const commands = require('../commands');