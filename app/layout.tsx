import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Apple Compare',description:'Общая база цен техники Apple на телефоне и компьютере',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Apple Compare',statusBarStyle:'default'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
