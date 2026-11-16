// ============================================================
// 写真の撮影・選択と縮小（Web版）
// スマホの写真（数MB）を長辺1600pxのJPEGに縮小して送信を軽くする
// ============================================================
// ignore: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

class PhotoPicker {
  /// [camera] が true ならカメラを起動（スマホ）、false なら写真を複数選択
  static Future<List<Uint8List>> pick({bool camera = false}) async {
    final input = html.FileUploadInputElement()..accept = 'image/*';
    if (camera) {
      input.setAttribute('capture', 'environment');
    } else {
      input.multiple = true;
    }
    final completer = Completer<List<html.File>>();
    input.onChange.listen((_) => completer.complete(input.files ?? []));
    input.click();
    final files = await completer.future;

    final out = <Uint8List>[];
    for (final f in files) {
      out.add(await _shrink(f));
    }
    return out;
  }

  static Future<Uint8List> _shrink(html.File file, {int maxSide = 1600}) async {
    final url = html.Url.createObjectUrlFromBlob(file);
    try {
      final img = html.ImageElement(src: url);
      await img.onLoad.first;
      final w = img.naturalWidth, h = img.naturalHeight;
      final scale = (w > h ? w : h) > maxSide ? maxSide / (w > h ? w : h) : 1.0;
      final cw = (w * scale).round(), ch = (h * scale).round();
      final canvas = html.CanvasElement(width: cw, height: ch);
      final ctx = canvas.context2D
        ..fillStyle = '#ffffff'
        ..fillRect(0, 0, cw, ch);
      ctx.drawImageScaled(img, 0, 0, cw, ch);
      final dataUrl = canvas.toDataUrl('image/jpeg', 0.85);
      return base64Decode(dataUrl.split(',').last);
    } finally {
      html.Url.revokeObjectUrl(url);
    }
  }
}
