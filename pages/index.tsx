import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import ExcelReader from "@/components/ExcelReader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const getServerSideProps = async () => {
  // const res = await fetch("https://api.github.com/users/kevinsawicki");
  // const data = await res.json();

  return {
    props: {
      // user: data,
    },
  };
}

export default function Home() {
  return (
    <div>
      <ExcelReader />
    </div>
  );
}
