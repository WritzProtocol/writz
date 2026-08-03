"use client";

import { useState } from "react";
import type { ProtocolRole } from "../types/products.types";

export function useRoleToggle(initial: ProtocolRole = "borrower") {
  const [role, setRole] = useState<ProtocolRole>(initial);
  return { role, setRole };
}
