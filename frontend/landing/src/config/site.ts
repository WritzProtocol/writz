import { env } from "./env";

export const SITE_NAME = "Writz Protocol";
export const SITE_ALTERNATE_NAME = "Writz";

export const ORGANIZATION_ID = `${env.siteUrl}/#organization`;
export const WEBSITE_ID = `${env.siteUrl}/#website`;

export const OG_IMAGE = {
  url: "/og.png?v=4",
  width: 2400,
  height: 1260,
  alt: "Writz Protocol. Native Bitcoin lending protocol on Stellar. No bridge, no custodian, no wrapped token.",
};
