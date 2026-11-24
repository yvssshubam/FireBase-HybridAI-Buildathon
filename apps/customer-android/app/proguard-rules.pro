# R8 rules for the release build (minify + resource shrinking are on).
# Firebase, CameraX, kotlinx.serialization and ZXing ship their own consumer rules; these keep the
# app's own reflective surfaces.

# Structured-output schemas: @Serializable + @Generable classes are deserialized by Firebase AI Logic
# (getObject) and their generated serializers / KSP schema extensions must survive shrinking.
-keep,includedescriptorclasses class com.fairclaim.customer.ai.**$$serializer { *; }
-keepclassmembers class com.fairclaim.customer.ai.** {
    *** Companion;
}
-keepclasseswithmembers class com.fairclaim.customer.ai.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep enum com.fairclaim.customer.ai.** { *; }

# Better stack traces in the debug panel / logcat without shipping names: keep line numbers only.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
