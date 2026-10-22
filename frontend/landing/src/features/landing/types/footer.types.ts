export interface FooterLink {
  label: string;
  /** "#" means we have nothing real to point at yet. */
  href: string;
}

export interface FooterLinkGroup {
  title: string;
  links: FooterLink[];
}
