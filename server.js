import { config } from './src/config.js';
import { initDatabase } from './src/database.js';
import { restoreLeaderClient } from './src/swc-client.js';
import { createApp } from './src/app.js';

// Initialize database and restore leader token
await initDatabase();
await restoreLeaderClient();

const app = createApp();

app.listen(config.port, () => {
  console.log(`SWC Inventory Control running at ${config.baseUrl}`);
});
