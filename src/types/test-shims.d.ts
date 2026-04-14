import type { Express } from "express";

declare module "jsonwebtoken" {
  export interface SignOptions {
    expiresIn?: string | number;
  }

  export function sign(payload: unknown, secret: string, options?: SignOptions): string;
  export function verify(token: string, secret: string): unknown;

  const jwt: {
    sign(payload: unknown, secret: string, options?: SignOptions): string;
    verify(token: string, secret: string): unknown;
  };

  export default jwt;
}

declare module "../server.js" {
  export const app: Express;
}
