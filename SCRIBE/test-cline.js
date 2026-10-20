const { run } = require('./src/skills/cline.js');
run({ op: 'ask', prompt: 'What is the capital of France?' })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error('ERROR:', e.message));
