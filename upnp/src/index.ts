import dotenv from 'dotenv';
import { startUpnpServer } from './server';

dotenv.config();

const PORT = parseInt(process.env.UPNP_PORT || '5050', 10);
const HOST = process.env.UPNP_HOST || '127.0.0.1';
const JELLITE_BACKEND_URL = process.env.JELLITE_BACKEND_URL || 'http://127.0.0.1:8080';
const JELLITE_API_KEY = process.env.JELLITE_API_KEY || '';
const JELLITE_USER_ID = process.env.JELLITE_USER_ID || 'jellite-user';

startUpnpServer(HOST, PORT, JELLITE_BACKEND_URL, JELLITE_API_KEY, JELLITE_USER_ID).catch(console.error);
