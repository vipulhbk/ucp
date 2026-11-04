import { ops } from "@/merchant/routes";

export const POST = (req: Request) => ops.cartUnsupported(req, "cancel_cart");
