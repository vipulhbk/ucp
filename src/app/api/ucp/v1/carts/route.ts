import { ops } from "@/merchant/routes";

export const POST = (req: Request) => ops.cartUnsupported(req, "create_cart");
