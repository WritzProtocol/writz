import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const writzVolume = volume("writz-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const writz = service("writz", {
    source: github("WritzProtocol/writz", { commitSha: "d5d4f8f6adc3b1ae47c09ff3765723115b84d77e", upstreamUrl: "https://github.com/WritzProtocol/writz" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "sfo": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
    domains: ["api.testnet.writz.xyz"],
    volumeMounts: { "/app/data": writzVolume },
    env: { BITCOIN_NETWORK: preserve(), COMMITMENT_TREE_ID: preserve(), CORS_ORIGIN: preserve(), DEFINDEX_API_KEY: preserve(), DEFINDEX_VAULT_ID: preserve(), PRIVATE_LEND_ID: preserve(), STELLAR_NETWORK_PASSPHRASE: preserve(), STELLAR_RPC_URL: preserve(), WRITZ_ENV: preserve() },
  });

  return project("writz-relayer", {
    resources: [writz, writzVolume],
  });
});
