import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Stockade ? Commerce operations',description:'Order, inventory and warehouse management for Northline Supply.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" data-scroll-behavior="smooth"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;}
