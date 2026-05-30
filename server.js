const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
try {
  app.listen(PORT, '0.0.0.0', () => console.log('OK port ' + PORT));
} catch(e) {
  console.error('ERR: ' + e.message);
  process.exit(1);
}
