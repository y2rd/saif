import os
import subprocess
import sys

def main():
    print("🚀 بدء بناء وتثبيت التطبيق على الجوال المتصل (Capacitor)...")
    print("================================================================")
    
    # التأكد من أن الهاتف متصل
    print("📱 جاري التحقق من الأجهزة المتصلة...")
    try:
        adb_check = subprocess.run(["adb", "devices"], capture_output=True, text=True)
        devices = adb_check.stdout.replace("List of devices attached", "").strip()
        if not devices:
            print("❌ تنبيه: لم يتم العثور على جوال متصل. يرجى التأكد من توصيل الجوال.")
            print("⏳ سنحاول المتابعة على أية حال...")
        else:
            print("✅ تم العثور على جهاز متصل.")
    except FileNotFoundError:
        print("⚠️ لم يتم العثور على أداة adb.")

    print("\n📦 جاري تحديث ملفات الموقع (Build)...")
    subprocess.run(["npm", "run", "build"], shell=True)
    
    print("\n🔄 جاري نسخ الملفات إلى تطبيق الأندرويد...")
    subprocess.run(["npx", "cap", "sync", "android"], shell=True)

    print("\n⚙️ جاري بناء تطبيق الأندرويد وتثبيته... (قد تستغرق دقائق في المرة الأولى)")
    print("==================================================================================\n")
    
    try:
        # أمر تشغيل وتثبيت التطبيق عبر Capacitor
        result = subprocess.run(["npx", "cap", "run", "android"], shell=True)
        
        if result.returncode == 0:
            print("\n🎉✅ تم تثبيت وفتح التطبيق المطابق لموقعك على الجوال بنجاح!")
        else:
            print("\n❌ حدث خطأ أثناء البناء. تأكد من إعدادات Android Studio.")
    except Exception as e:
        print(f"\n❌ حدث خطأ غير متوقع: {e}")

if __name__ == "__main__":
    main()
