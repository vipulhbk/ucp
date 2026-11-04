export const slugFor = (file: string): string => file.split("/").at(-1)!.replace(/\.md$/i, "").toLowerCase().replace(/_/g, "-");
