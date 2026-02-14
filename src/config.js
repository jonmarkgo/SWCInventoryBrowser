import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  dbPath: process.env.DB_PATH || './data/inventory.db',
  swc: {
    clientId: process.env.SWC_CLIENT_ID,
    clientSecret: process.env.SWC_CLIENT_SECRET,
    redirectUri: process.env.SWC_REDIRECT_URI || null, // auto-derived from BASE_URL if not set
  },
  inventoryFetchLimit: parseInt(process.env.INVENTORY_FETCH_LIMIT || '0', 10) || 0, // 0 = no limit
};
