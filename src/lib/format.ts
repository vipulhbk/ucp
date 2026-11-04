/** Integer paise → "₹4,499.00" (minor units are the protocol's amount convention). */
export function rupees(paise: number, currency = "INR"): string {
  const sign = paise < 0 ? "−" : "";
  const abs = Math.abs(paise) / 100;
  const body = abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${currency === "INR" ? "₹" : `${currency} `}${body}`;
}
