import java.nio.file.*;
import org.apache.commons.io.FilenameUtils;
import org.springframework.web.bind.annotation.*;

@RestController
public class PlantillaController {
    @GetMapping("/plantillas/{nombre}")
    public String leer(@PathVariable String nombre) throws Exception {
        String seguro = FilenameUtils.getName(nombre);
        return Files.readString(Paths.get("plantillas", seguro));
    }
}
