"use client";

import { useState } from "react";
import { EarnPosition } from "./EarnPosition";
import { EarnDeposit } from "./EarnDeposit";

/**
 * The Earn tab: live position and APY (#110) above the deposit flow (#109).
 *
 * The panel owns the refresh counter so a landed deposit updates the position
 * immediately rather than on the next poll. Polling is the safety net for
 * everything this tab did not cause - accrued yield, a deposit made on another
 * device - not the mechanism for the user's own action.
 *
 * The withdraw flow (#111) slots in here the same way.
 */
export function EarnPanel() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-12">
      <EarnPosition refreshKey={refreshKey} />
      <EarnDeposit onDeposited={() => setRefreshKey((n) => n + 1)} />
    </div>
  );
}
