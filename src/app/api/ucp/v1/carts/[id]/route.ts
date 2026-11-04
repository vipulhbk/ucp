import { ops } from "@/merchant/routes";

export const GET = (req: Request) => ops.cartUnsupported(req, "get_cart");
export const PUT = (req: Request) => ops.cartUnsupported(req, "update_cart");
