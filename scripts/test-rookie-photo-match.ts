import { findUniquePhotoMatch } from "../supabase/functions/hr-rookies/photo-match";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const photo = { id: "1", full_name: "Трифонова Татьяна Сергеевна", city: "Петропавловск-Камчатский", photo_path: "inbox/1.jpg" };

check(
  findUniquePhotoMatch({ full_name: "Татьяна Трифонова", city: "Петропавловск-Камчатский" }, [photo])?.id === "1",
  "Должно совпадать ФИО в другом порядке и без отчества",
);

check(
  findUniquePhotoMatch({ full_name: "Татьяна Трифонова", city: "Москва" }, [photo]) === null,
  "Разные заполненные города не должны совпадать",
);

check(
  findUniquePhotoMatch({ full_name: "Татьяна Трифонова", city: "" }, [photo, { ...photo, id: "2" }]) === null,
  "Неоднозначное совпадение не должно выбирать фото",
);

check(
  findUniquePhotoMatch({ full_name: "Татьяна Трифонова", city: "" }, [{ ...photo, photo_path: null }]) === null,
  "Карточка без фото не должна считаться источником",
);

console.log("rookie photo matching: ok");
