import { Bitcoin, CircleDollarSign, Rocket, Hexagon, ShipWheel, Key, Layers, Wallet } from "lucide-react";
import type { EcosystemLogo } from "../types/ecosystem.types";

export const ecosystemLogos: EcosystemLogo[] = [
  { name: "Stellar", icon: Rocket },
  { name: "Soroban", icon: Hexagon },
  { name: "Bitcoin", icon: Bitcoin },
  { name: "USDC", icon: CircleDollarSign },
  { name: "Xverse", icon: Wallet },
  { name: "Freighter", icon: ShipWheel },
  { name: "Privy", icon: Key },
  { name: "Blend", icon: Layers },
];
