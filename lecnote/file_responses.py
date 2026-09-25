from fastapi.responses import FileResponse

INLINE_MEDIA_TYPES = {
    "txt": "text/plain",
    "md": "text/plain",
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


def original_file_response(item):
    # Display names can change; only the stored upload kind controls rendering.
    media_type = INLINE_MEDIA_TYPES.get(item.get("kind"))
    return FileResponse(
        item["path"],
        filename=item["name"],
        media_type=media_type or "application/octet-stream",
        content_disposition_type="inline" if media_type else "attachment",
        headers={"X-Content-Type-Options": "nosniff"},
    )
