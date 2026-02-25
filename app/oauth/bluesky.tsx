import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

export default function BlueskyOAuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
        return;
      }

      router.replace("/");
    }, 0);

    return () => clearTimeout(timer);
  }, [router]);

  return <View style={{ flex: 1 }} />;
}
