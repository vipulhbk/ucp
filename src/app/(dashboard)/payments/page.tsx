import { PageHeader, SimulatedBadge } from "@/components/shell/page-header";
import { PaymentPanel } from "./payment-panel";

export const metadata = { title: "Payment Simulator · UCP Playground" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader
        title="Payment Simulator"
        badge={<SimulatedBadge />}
        description={
          <>
            A <strong>simulated</strong> payment handler modeled on the Processor Tokenizer example in the UCP spec. The handler is real UCP structure (advertised in the profile, echoed in checkout, token submitted in{" "}
            <code className="font-mono">payment.instruments</code>); the credential provider and PSP behind it are fake. Only published test cards are accepted. Real card numbers are refused and never stored.
          </>
        }
      />
      <PaymentPanel />
    </>
  );
}
