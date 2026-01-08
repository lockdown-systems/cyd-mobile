import React from "react";
import { View } from "react-native";

// Mock MaterialIcons component
const MockIcon = ({ name, size, color, ...props }) => {
  return React.createElement(View, {
    testID: `icon-${name}`,
    "data-name": name,
    "data-size": size,
    "data-color": color,
    ...props,
  });
};

export const MaterialIcons = MockIcon;
export const Ionicons = MockIcon;
export const FontAwesome = MockIcon;
export const Feather = MockIcon;
