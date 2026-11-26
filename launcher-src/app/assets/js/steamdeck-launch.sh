#!/usr/bin/env bash
# Steam may still supply this variable to the historical shortcut.
unset APPIMAGE_EXTRACT_AND_RUN
umask 077
set -eu
install_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
image="$install_dir/payload/KRWA-Launcher.AppImage"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/krwa-launcher/runtime"
mkdir -p -- "$cache"
# Keep the Steam-tracked command alive on repeated clicks until the first exits.
exec 9>"$cache/launch.lock"
if ! flock -n 9; then
    flock -s 9
    exit 0
fi

case "${LANGUAGE:-${LC_MESSAGES:-${LANG:-en}}}" in
    ru*) preparing='Подготавливаем новую версию лаунчера…'; opening='Открываем KRWA Launcher…'; failed='Не удалось открыть лаунчер. Попробуйте снова. Журнал запуска:' ;;
    pl*) preparing='Przygotowywanie nowej wersji launchera…'; opening='Otwieranie KRWA Launcher…'; failed='Nie udało się otworzyć launchera. Spróbuj ponownie. Dziennik:' ;;
    *) preparing='Preparing the new launcher version…'; opening='Opening KRWA Launcher…'; failed='Could not open the launcher. Try again. Startup log:' ;;
esac
run_dir=$(mktemp -d -- "${XDG_RUNTIME_DIR:-/tmp}/krwa-start.XXXXXXXX")
stage=''
child=''
splash=''
cleanup() {
    if [[ -n $splash ]]; then kill "$splash" 2>/dev/null || true; fi
    if [[ -n $stage ]]; then rm -rf -- "$stage"; fi
    rm -rf -- "$run_dir"
}
trap cleanup EXIT
trap 'if [[ -n $child ]]; then kill "$child" 2>/dev/null || true; fi; exit 143' TERM HUP INT
log="$cache/startup.log"
printf '%s\n' "$(date -Is) Starting launcher" > "$log"
show_error() {
    if [[ -n $splash ]]; then kill "$splash" 2>/dev/null || true; fi
    printf '%s\n' "$1" >> "$log"
    if command -v zenity >/dev/null; then
        GDK_BACKEND=x11 zenity --error --title="KRWA Launcher" --no-markup --text="$failed $log" 9>&- || true
    fi
    exit 1
}
# electron-updater replaces the payload on exit. Recover the previous verified
# executable if the system lost power between unlinking and moving the update.
previous="$install_dir/payload/.last-working.AppImage"
if [[ ! -e $image && -x $previous ]]; then ln -- "$previous" "$image" || true; fi
[[ -x $image ]] || show_error 'Launcher image is missing'
key=$(stat -Lc '%d-%i-%s-%Y' -- "$image")
bundle="$cache/build-$key"
message=$opening
if [[ ! -x $bundle/AppRun ]]; then message=$preparing; fi
if command -v zenity >/dev/null && [[ -n ${DISPLAY:-} ]]; then
    mkfifo "$run_dir/messages"
    # Opening both ends keeps a closed or unavailable dialog from blocking startup.
    exec 8<>"$run_dir/messages"
    GDK_BACKEND=x11 zenity --progress --pulsate --no-cancel --auto-close --width=430 \
        --title="KRWA Launcher" --text="$message" <"$run_dir/messages" 8>&- 9>&- 2>/dev/null &
    splash=$!
fi
if [[ ! -x $bundle/AppRun ]]; then
    stage=$(mktemp -d -- "$cache/.prepare.XXXXXXXX")
    (cd -- "$stage" && "$image" --appimage-extract >/dev/null) 9>&- 2>>"$log" || show_error 'AppImage extraction failed'
    [[ -x $stage/squashfs-root/AppRun && -s $stage/squashfs-root/resources/app.asar ]] || show_error 'Incomplete extraction'
    [[ $(stat -Lc '%d-%i-%s-%Y' -- "$image") == "$key" ]] || show_error 'Image changed during extraction'
    mv -T -- "$stage/squashfs-root" "$bundle"
    printf 'Prepared version %s\n' "$key" >> "$log"
fi
# Only the lock holder uses cached bundles. Clean interrupted preparations too.
for old in "$cache"/build-* "$cache"/.prepare.*; do
    [[ -d $old && $old != "$bundle" && $old != "$stage" ]] || continue
    rm -rf -- "$old"
done
if [[ -n $splash ]]; then printf '# %s\n' "$opening" >&8; fi
export APPIMAGE="$image" APPDIR="$bundle" OWD="$PWD" KRWA_STARTUP_DIR="$run_dir"
"$bundle/AppRun" "$@" 8>&- 9>&- &
child=$!
# Keep Steam's splash until Electron has painted its first window.
while [[ ! -f $run_dir/ready ]] && kill -0 "$child" 2>/dev/null; do
    if (( SECONDS >= 60 )) && [[ -n $splash ]]; then
        kill "$splash" 2>/dev/null || true
        wait "$splash" 2>/dev/null || true
        splash=''
    fi
    sleep 0.1
done
if [[ -f $run_dir/ready && ! $image -ef $previous ]]; then
    # Same filesystem as the payload. Rename never exposes a partial backup.
    backup_dir=$(mktemp -d -- "$install_dir/payload/.backup.XXXXXXXX")
    if ln -- "$image" "$backup_dir/image"; then mv -Tf -- "$backup_dir/image" "$previous"; fi
    rmdir -- "$backup_dir" || true
fi
if [[ -n $splash ]]; then kill "$splash" 2>/dev/null || true; wait "$splash" 2>/dev/null || true; splash=''; fi
status=0
wait "$child" || status=$?
[[ -f $run_dir/ready ]] || show_error "Launcher exited before showing a window (status $status)"
exit "$status"
