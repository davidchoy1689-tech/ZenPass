// Category → Pexels image mapping
var CATEGORY_IMAGES = {
  "伸展": "https://images.pexels.com/photos/4056535/pexels-photo-4056535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "瑜伽": "https://images.pexels.com/photos/4056535/pexels-photo-4056535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "冥想": "https://images.pexels.com/photos/3822622/pexels-photo-3822622.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "健身": "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "HIIT": "https://images.pexels.com/photos/3755342/pexels-photo-3755342.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "拳擊": "https://images.pexels.com/photos/3755342/pexels-photo-3755342.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "舞蹈": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "皮拉提斯": "https://images.pexels.com/photos/4056535/pexels-photo-4056535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "產後": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "遠足": "https://images.pexels.com/photos/917510/pexels-photo-917510.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "長者": "https://images.pexels.com/photos/3822622/pexels-photo-3822622.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "空中瑜伽": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "太極": "https://images.pexels.com/photos/3822622/pexels-photo-3822622.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "心肺": "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "攀岩": "https://images.pexels.com/photos/373912/pexels-photo-373912.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "芭蕾": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "露營": "https://images.pexels.com/photos/917510/pexels-photo-917510.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop"
};

function getCategoryImage(cat) {
  if (!cat) return "";
  for (var k in CATEGORY_IMAGES) {
    if (cat.indexOf(k) >= 0) return CATEGORY_IMAGES[k];
  }
  return "";
}
