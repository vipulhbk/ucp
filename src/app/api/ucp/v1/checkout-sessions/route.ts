import { ops } from "@/merchant/routes";

export const POST = (req: Request) => ops.createCheckout(req);
