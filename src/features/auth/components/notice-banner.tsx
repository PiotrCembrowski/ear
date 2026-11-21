import { Alert } from "@/components/ui/alert";
import { readNotice } from "../notices";

export function NoticeBanner({ notice }: { notice: string | string[] | undefined }) {
  const found = readNotice(notice);
  return found ? <Alert tone={found.tone}>{found.text}</Alert> : null;
}
