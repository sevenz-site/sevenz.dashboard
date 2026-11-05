import type { ReactNode } from "react";
import { TransactionDetailTracker } from "@/components/dashboard/transaction-detail-tracker";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <TransactionDetailTracker />
      {children}
    </>
  );
}
