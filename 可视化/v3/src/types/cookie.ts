export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  hostOnly: boolean;
  sameSite: string;
  session: boolean;
  storeId: string;
} 